import { useEffect, useMemo, useState } from "react";
import type { AcentaApi } from "./api";
import { ApiError } from "./api";
import {
  BillingClient,
  type BillingSummary,
  type PlanId,
  type UsageMeter,
} from "./billing-api";

function MeterCard({
  label,
  meter,
  unit,
  isCurrency = false,
}: {
  label: string;
  meter: UsageMeter;
  unit: string;
  isCurrency?: boolean;
}) {
  const usedDisplay = isCurrency
    ? `$${meter.used.toFixed(2)} USD`
    : `${meter.used} ${unit}`;
  const limitDisplay = isCurrency
    ? `$${meter.limit.toFixed(2)} USD`
    : `${meter.limit} ${unit}`;
  const barColor = meter.at_limit
    ? "#c62828"
    : meter.near_limit
      ? "#b45309"
      : "#1f6f54";

  return (
    <div
      style={{
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 12,
        padding: 14,
        background: "var(--surface, #fff)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {usedDisplay} / {limitDisplay}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(meter.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 8,
          borderRadius: 999,
          background: "#e2e8f0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, meter.percent)}%`,
            height: "100%",
            background: barColor,
            transition: "width 180ms ease",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 11,
          color: "#64748b",
        }}
      >
        <span>{meter.percent.toFixed(1)}% usado</span>
        <span>
          Restante:{" "}
          {isCurrency
            ? `$${meter.remaining.toFixed(2)}`
            : `${meter.remaining}`}
        </span>
      </div>
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

  return (
    <section className="account-studio-view" aria-label="Mi plan y uso">
      <header className="account-studio-header">
        <div>
          <h1>Mi plan y consumo mensual</h1>
          <p className="support-muted">
            Cuotas transparentes en tiempo real, historial de movimientos y
            suscripción lista para Stripe.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          <section
            style={{
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 14,
              padding: 18,
              background: "var(--surface, #fff)",
              marginBottom: 18,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "#eef6f2",
                  color: "#1f6f54",
                  marginBottom: 6,
                }}
              >
                Plan activo · {summary.subscription.status}
              </span>
              <h2 style={{ margin: "2px 0 4px", fontSize: 20 }}>
                {summary.subscription.plan_name}
              </h2>
              <p className="support-muted" style={{ margin: 0, fontSize: 13 }}>
                {summary.subscription.price_mxn_monthly === 0
                  ? "$0 MXN / mes"
                  : `$${summary.subscription.price_mxn_monthly} ${summary.subscription.currency} / mes`}{" "}
                · Proveedor:{" "}
                {summary.stripe_configured ? "Stripe" : "Vista previa beta"}
              </p>
            </div>
            {summary.stripe_configured && (
              <button
                type="button"
                className="support-btn-secondary"
                onClick={() => void handlePortal()}
              >
                Administrar facturación (Stripe)
              </button>
            )}
          </section>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>
            Uso del mes actual
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 22,
            }}
          >
            <MeterCard
              label="Turnos de IA"
              meter={summary.usage.ai_turns}
              unit="turnos"
            />
            <MeterCard
              label="Anexos generados"
              meter={summary.usage.annexes}
              unit="anexos"
            />
            <MeterCard
              label="Trabajos de impresión"
              meter={summary.usage.print_jobs}
              unit="impresiones"
            />
            <MeterCard
              label="Documentos OCR"
              meter={summary.usage.documents}
              unit="docs"
            />
            <MeterCard
              label="Presupuesto IA estimado"
              meter={summary.usage.ai_budget_usd}
              unit="USD"
              isCurrency
            />
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>
            Planes disponibles
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
              marginBottom: 22,
            }}
          >
            {summary.plans.map((plan) => {
              const isCurrent = summary.subscription.plan_id === plan.id;
              return (
                <article
                  key={plan.id}
                  style={{
                    border: isCurrent
                      ? "2px solid #1f6f54"
                      : "1px solid var(--border, #e2e8f0)",
                    borderRadius: 14,
                    padding: 16,
                    background: "var(--surface, #fff)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>
                      {plan.name}
                    </h3>
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      ${plan.price_mxn_monthly}{" "}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "#64748b",
                        }}
                      >
                        {plan.currency}/mes
                      </span>
                    </p>
                    <p
                      className="support-muted"
                      style={{ fontSize: 12, margin: "0 0 10px" }}
                    >
                      {plan.tagline}
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      {plan.features.map((feat) => (
                        <li key={feat}>{feat}</li>
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

          <h2 style={{ fontSize: 16, marginBottom: 8 }}>
            Historial de movimientos y cuotas
          </h2>
          {summary.ledger.length === 0 ? (
            <p className="support-muted" style={{ fontSize: 13 }}>
              Aún no hay cambios de plan ni eventos de facturación registrados.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "8px 6px" }}>Fecha</th>
                    <th style={{ padding: "8px 6px" }}>Evento</th>
                    <th style={{ padding: "8px 6px" }}>Métrica</th>
                    <th style={{ padding: "8px 6px" }}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.ledger.map((row) => (
                    <tr
                      key={row.id}
                      style={{ borderBottom: "1px solid #f1f5f9" }}
                    >
                      <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                        {new Date(row.created_at).toLocaleString("es-MX")}
                      </td>
                      <td style={{ padding: "8px 6px" }}>{row.event_type}</td>
                      <td style={{ padding: "8px 6px" }}>{row.metric}</td>
                      <td style={{ padding: "8px 6px", color: "#475569" }}>
                        {JSON.stringify(row.metadata)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
