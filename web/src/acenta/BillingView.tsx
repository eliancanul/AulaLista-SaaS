import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AcentaApi } from "./api";
import { ApiError } from "./api";
import {
  BillingClient,
  type BillingSummary,
  type PlanId,
  type UsageMeter,
} from "./billing-api";
import {
  BudgetIcon,
  ChatTurnsIcon,
  CheckCircleIcon,
  CrownIcon,
  InfinityIcon,
  PrinterIcon,
  ScanDocIcon,
  SchoolBuildingIcon,
  ShieldLockIcon,
  SparklesIcon,
  WorksheetIcon,
} from "./StudioVisuals";

type MeterTone = "clay" | "sage" | "ochre" | "slate";

function formatEventLabel(eventType: string): { label: string; tone: MeterTone } {
  switch (eventType) {
    case "courtesy_pro_granted":
      return { label: "Cortesía Pro activada", tone: "ochre" };
    case "plan_changed":
      return { label: "Cambio de plan", tone: "sage" };
    case "checkout_completed":
    case "subscription_updated":
      return { label: "Suscripción Stripe", tone: "sage" };
    case "subscription_canceled":
      return { label: "Suscripción cancelada", tone: "clay" };
    default:
      return { label: eventType.replace(/_/g, " "), tone: "slate" };
  }
}

function formatLedgerDetail(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof metadata.plan_id === "string") {
    const names: Record<string, string> = {
      free: "Gratis · Beta Docente",
      docente: "Pro Docente",
      escuela: "Escuela / Directivo",
    };
    parts.push(`Plan: ${names[metadata.plan_id] ?? metadata.plan_id}`);
  }
  if (typeof metadata.reason === "string" && metadata.reason.trim()) {
    parts.push(metadata.reason.trim());
  }
  if (typeof metadata.mode === "string") {
    parts.push(metadata.mode === "beta_preview" ? "Vista previa beta" : metadata.mode);
  }
  if (parts.length > 0) return parts.join(" · ");
  const keys = Object.keys(metadata);
  return keys.length === 0 ? "—" : keys.map((k) => `${k}: ${String(metadata[k])}`).join(" · ");
}

function MeterCard({
  label,
  meter,
  unit,
  icon,
  tone,
  isCurrency = false,
}: {
  label: string;
  meter: UsageMeter;
  unit: string;
  icon: ReactNode;
  tone: MeterTone;
  isCurrency?: boolean;
}) {
  const isUnlimited = Boolean(meter.unlimited) || meter.limit === null;
  const usedDisplay = isCurrency
    ? `$${meter.used.toFixed(2)} USD`
    : `${meter.used} ${unit}`;
  const limitDisplay = isUnlimited
    ? "Sin límite"
    : isCurrency
      ? `$${(meter.limit ?? 0).toFixed(2)} USD`
      : `${meter.limit} ${unit}`;
  const barTone = meter.at_limit
    ? "is-danger"
    : meter.near_limit
      ? "is-warn"
      : "is-healthy";

  return (
    <div className={`billing-meter-card${isUnlimited ? " is-unlimited" : ""}`}>
      <div className="billing-meter-top">
        <span className={`billing-meter-icon is-${tone}`}>{icon}</span>
        <div className="billing-meter-headings">
          <strong>{label}</strong>
          <span className="billing-meter-figure">
            {isUnlimited ? usedDisplay : `${usedDisplay} / ${limitDisplay}`}
          </span>
        </div>
      </div>

      {isUnlimited ? (
        <div className="billing-unlimited-pill">
          <InfinityIcon size={14} />
          <span>Ilimitado · Sin costo extra</span>
        </div>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={Math.round(meter.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="billing-progress-track"
          >
            <div
              className={`billing-progress-fill ${barTone}`}
              style={{ width: `${Math.min(100, meter.percent)}%` }}
            />
          </div>
          <div className="billing-meter-foot">
            <span>{meter.percent.toFixed(1)}% usado</span>
            <span>
              Restante:{" "}
              {isCurrency
                ? `$${(meter.remaining ?? 0).toFixed(2)}`
                : `${meter.remaining ?? 0}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function BillingView({
  api,
  onOpenSupport,
}: {
  api: AcentaApi;
  onOpenSupport: () => void;
}) {
  const client = useMemo(() => new BillingClient(api), [api]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await client.getSummary());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar tu plan y consumo.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api.session.scopeId]);

  async function selectPlan(planId: PlanId) {
    if (!summary || busyPlan) return;
    setBusyPlan(planId);
    setError(null);
    setMessage(null);
    try {
      const usePreview = !summary.stripe_configured || planId === "free";
      const res = await client.checkout({
        plan_id: planId,
        preview_switch: usePreview,
        success_url: window.location.href,
        cancel_url: window.location.href,
      });
      if (res.mode === "stripe_checkout" && res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      if (res.summary) {
        setSummary(res.summary);
      } else {
        await refresh();
      }
      setMessage(
        planId === "free"
          ? "Tu cuenta ahora está en el plan Gratis · Beta Docente."
          : `Plan cambiado en modo vista previa beta a ${planId.toUpperCase()}.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "stripe_not_configured") {
        setError("Stripe aún no está configurado en este entorno.");
      } else {
        setError(
          err instanceof Error
            ? `No se pudo actualizar el plan (${err.message}).`
            : "No se pudo actualizar el plan.",
        );
      }
    } finally {
      setBusyPlan(null);
    }
  }

  async function handlePortal() {
    setError(null);
    try {
      const res = await client.openPortal();
      if (res.portal_url) {
        window.open(res.portal_url, "_blank", "noopener");
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "stripe_not_configured"
          ? "El portal de facturación Stripe se activará al configurar llaves de cobro."
          : "No se pudo abrir el portal de facturación.",
      );
    }
  }

  const isCourtesy = Boolean(
    summary &&
      (summary.subscription.is_courtesy ||
        summary.subscription.billing_provider === "courtesy_pro"),
  );

  return (
    <section className="account-studio-view billing-studio" aria-label="Mi plan y uso">
      <header className="account-studio-header">
        <div>
          <h1>Mi plan y consumo mensual</h1>
          <p className="support-muted">
            Cuotas transparentes en tiempo real, beneficios de tu plan y control
            claro de impresión, documentos e IA.
          </p>
        </div>
        <div className="docs-header-actions">
          <button
            type="button"
            className="support-btn-secondary"
            onClick={() => void refresh()}
          >
            Actualizar uso
          </button>
          <button
            type="button"
            className="support-btn-secondary"
            onClick={onOpenSupport}
          >
            Soporte
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="support-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="support-success">
          {message}
        </p>
      )}

      {loading || !summary ? (
        <p className="support-muted">Cargando estado de tu plan…</p>
      ) : (
        <>
          {/* Hero active subscription banner */}
          <section className={`billing-hero-card${isCourtesy ? " is-courtesy" : ""}`}>
            <div className="billing-hero-main">
              <span className={`billing-hero-emblem${isCourtesy ? " is-ochre" : " is-sage"}`}>
                {isCourtesy ? <CrownIcon size={24} /> : <ShieldLockIcon size={24} />}
              </span>
              <div>
                <span className={`billing-hero-badge${isCourtesy ? " is-ochre" : " is-sage"}`}>
                  {isCourtesy
                    ? "Cuenta Pro de cortesía · Sin cobro"
                    : `Plan activo · ${summary.subscription.status}`}
                </span>
                <h2>{summary.subscription.plan_name}</h2>
                <p className="support-muted billing-hero-meta">
                  {isCourtesy
                    ? "$0 MXN / mes · Cortesía activa sin vencimiento"
                    : summary.subscription.price_mxn_monthly === 0
                      ? "$0 MXN / mes"
                      : `$${summary.subscription.price_mxn_monthly} ${summary.subscription.currency} / mes`}{" "}
                  · Proveedor:{" "}
                  {isCourtesy
                    ? "Cortesía Pro"
                    : summary.stripe_configured
                      ? "Stripe"
                      : "Vista previa beta"}
                </p>
              </div>
            </div>

            <div className="billing-hero-right">
              <div className="billing-hero-perks">
                <span className="billing-perk-chip">
                  <ChatTurnsIcon size={13} />
                  {summary.usage.ai_turns.limit ?? "∞"} turnos IA
                </span>
                <span className="billing-perk-chip">
                  <WorksheetIcon size={13} />
                  {summary.usage.annexes.limit ?? "∞"} anexos
                </span>
                <span className="billing-perk-chip is-highlight">
                  <PrinterIcon size={13} />
                  {summary.usage.print_jobs.unlimited || summary.usage.print_jobs.limit === null
                    ? "Impresión ilimitada"
                    : `${summary.usage.print_jobs.limit} impresiones/mes`}
                </span>
              </div>
              {summary.stripe_configured && !isCourtesy && (
                <button
                  type="button"
                  className="support-btn-secondary"
                  onClick={() => void handlePortal()}
                >
                  Administrar facturación (Stripe)
                </button>
              )}
            </div>
          </section>

          {/* Monthly usage meters */}
          <div className="billing-section-head">
            <h2>Uso del mes actual</h2>
            <span className="billing-period-pill">
              Corte mensual transparente
            </span>
          </div>
          <div className="billing-meters-grid">
            <MeterCard
              label="Turnos de IA"
              meter={summary.usage.ai_turns}
              unit="turnos"
              tone="clay"
              icon={<ChatTurnsIcon size={17} />}
            />
            <MeterCard
              label="Anexos generados"
              meter={summary.usage.annexes}
              unit="anexos"
              tone="sage"
              icon={<WorksheetIcon size={17} />}
            />
            <MeterCard
              label="Trabajos de impresión"
              meter={summary.usage.print_jobs}
              unit="impresiones"
              tone="sage"
              icon={<PrinterIcon size={17} />}
            />
            <MeterCard
              label="Documentos OCR"
              meter={summary.usage.documents}
              unit="docs"
              tone="ochre"
              icon={<ScanDocIcon size={17} />}
            />
            <MeterCard
              label="Presupuesto IA estimado"
              meter={summary.usage.ai_budget_usd}
              unit="USD"
              tone="slate"
              icon={<BudgetIcon size={17} />}
              isCurrency
            />
          </div>

          {/* Plans comparison */}
          <div className="billing-section-head">
            <h2>Planes disponibles</h2>
            <span className="support-muted" style={{ fontSize: 12.5 }}>
              Impresión remota ilimitada desde Pro Docente
            </span>
          </div>
          <div className="billing-plans-grid">
            {summary.plans.map((plan) => {
              const isCurrent = summary.subscription.plan_id === plan.id;
              const isRecommended = plan.id === "docente";
              const PlanIcon =
                plan.id === "escuela"
                  ? SchoolBuildingIcon
                  : plan.id === "docente"
                    ? SparklesIcon
                    : WorksheetIcon;
              const tone: MeterTone =
                plan.id === "docente"
                  ? "sage"
                  : plan.id === "escuela"
                    ? "ochre"
                    : "clay";

              return (
                <article
                  key={plan.id}
                  className={`billing-plan-card${isCurrent ? " is-current" : ""}${isRecommended ? " is-recommended" : ""}`}
                >
                  <div>
                    <div className="billing-plan-card-top">
                      <span className={`billing-meter-icon is-${tone}`}>
                        <PlanIcon size={17} />
                      </span>
                      {isCurrent ? (
                        <span className="billing-plan-tag is-current">Plan actual</span>
                      ) : isRecommended ? (
                        <span className="billing-plan-tag is-popular">Recomendado</span>
                      ) : null}
                    </div>

                    <h3 className="billing-plan-name">{plan.name}</h3>
                    <p className="billing-plan-price">
                      ${plan.price_mxn_monthly}{" "}
                      <span>{plan.currency}/mes</span>
                    </p>
                    <p className="support-muted billing-plan-tagline">
                      {plan.tagline}
                    </p>

                    {/* Quick scannable visual quota matrix */}
                    <div className="billing-plan-stats">
                      <div className="billing-stat-cell">
                        <span>IA / mes</span>
                        <strong>{plan.limits.ai_turns}</strong>
                      </div>
                      <div className="billing-stat-cell">
                        <span>Anexos</span>
                        <strong>{plan.limits.annexes}</strong>
                      </div>
                      <div className="billing-stat-cell">
                        <span>Impresión</span>
                        <strong>
                          {plan.limits.print_jobs === null
                            ? "Ilimitada"
                            : `${plan.limits.print_jobs}/mes`}
                        </strong>
                      </div>
                      <div className="billing-stat-cell">
                        <span>Docs OCR</span>
                        <strong>{plan.limits.documents}</strong>
                      </div>
                    </div>

                    <ul className="billing-features-list">
                      {plan.features.map((feat) => (
                        <li key={feat}>
                          <CheckCircleIcon size={14} className="billing-check-icon" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    className={
                      isCurrent ? "support-btn-secondary" : "support-btn-primary"
                    }
                    disabled={isCurrent || busyPlan !== null}
                    onClick={() => void selectPlan(plan.id)}
                  >
                    {isCurrent
                      ? "Plan actual"
                      : busyPlan === plan.id
                        ? "Actualizando…"
                        : summary.stripe_configured && plan.id !== "free"
                          ? `Suscribirse a ${plan.name}`
                          : `Probar ${plan.name}`}
                  </button>
                </article>
              );
            })}
          </div>

          {/* Ledger */}
          <div className="billing-section-head">
            <h2>Historial de movimientos y cuotas</h2>
          </div>
          {summary.ledger.length === 0 ? (
            <div className="billing-empty-ledger">
              <p className="support-muted" style={{ margin: 0, fontSize: 13 }}>
                Aún no hay cambios de plan ni eventos de facturación registrados.
              </p>
            </div>
          ) : (
            <div className="billing-ledger-wrap">
              <table className="billing-ledger-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Evento</th>
                    <th>Métrica</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.ledger.map((row) => {
                    const ev = formatEventLabel(row.event_type);
                    return (
                      <tr key={row.id}>
                        <td className="billing-ledger-date">
                          {new Date(row.created_at).toLocaleString("es-MX")}
                        </td>
                        <td>
                          <span className={`billing-event-pill is-${ev.tone}`}>
                            {ev.label}
                          </span>
                        </td>
                        <td>{row.metric}</td>
                        <td className="billing-ledger-detail">
                          {formatLedgerDetail(row.metadata)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
