import type { AcentaApi } from "./api";

export type PlanId = "free" | "docente" | "escuela";

export interface PlanLimits {
  ai_turns: number;
  annexes: number;
  print_jobs: number;
  documents: number;
  ai_budget_usd: number;
}

export interface PlanCatalogItem {
  id: PlanId;
  name: string;
  tagline: string;
  price_mxn_monthly: number;
  currency: string;
  limits: PlanLimits;
  features: string[];
}

export interface UsageMeter {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  at_limit: boolean;
  near_limit: boolean;
}

export interface LedgerEntry {
  id: string;
  event_type: string;
  metric: string;
  quantity: number;
  estimated_usd: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BillingSummary {
  scope_id: string;
  subscription: {
    plan_id: PlanId;
    plan_name: string;
    price_mxn_monthly: number;
    currency: string;
    status: string;
    billing_provider: string;
    cancel_at_period_end: boolean;
    current_period_start: string;
    current_period_end: string;
  };
  period: {
    start: string;
    end: string;
  };
  usage: {
    ai_turns: UsageMeter;
    annexes: UsageMeter;
    print_jobs: UsageMeter;
    documents: UsageMeter;
    ai_budget_usd: UsageMeter;
  };
  quota_status: "healthy" | "near_limit" | "limit_reached";
  stripe_configured: boolean;
  ledger: LedgerEntry[];
  plans: PlanCatalogItem[];
}

export class BillingClient {
  constructor(private readonly api: AcentaApi) {}

  async getSummary(): Promise<BillingSummary> {
    return (await this.api.scopedJson("billing/summary")) as BillingSummary;
  }

  async checkout(payload: {
    plan_id: PlanId;
    preview_switch?: boolean;
    success_url?: string;
    cancel_url?: string;
  }): Promise<{
    mode: "stripe_checkout" | "beta_preview";
    checkout_url?: string;
    session_id?: string;
    summary?: BillingSummary;
  }> {
    return (await this.api.scopedJson("billing/checkout", "POST", payload)) as {
      mode: "stripe_checkout" | "beta_preview";
      checkout_url?: string;
      session_id?: string;
      summary?: BillingSummary;
    };
  }

  async openPortal(): Promise<{ portal_url: string }> {
    return (await this.api.scopedJson("billing/portal", "POST")) as {
      portal_url: string;
    };
  }
}
