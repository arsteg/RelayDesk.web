/**
 * Shared API contracts for the RelayDesk ordering clients (web + mobile).
 *
 * TYPES ONLY. All business rules — order totals, tax, status transitions — live
 * on the FastAPI backend (apps/api). These interfaces describe the JSON the API
 * returns and accepts so the two clients cannot drift apart.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "READY",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_TYPES = ["PICKUP", "DELIVERY"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID", "OVERPAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Human-readable labels for order statuses (shared across clients). */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Statuses considered "open"/active for the live dashboard. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PROGRESS", "READY"];

/** Allowed status transitions — mirrors the backend (apps/api/app/models.py). */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["READY", "COMPLETED", "CANCELLED"],
  READY: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

// --- error envelope ---------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// --- menu -------------------------------------------------------------------

export interface MenuItem {
  id: string;
  name: string;
  categoryId: string | null;
  description: string | null;
  unit: string; // pricing/billing unit
  priceMinor: number; // the customer's resolved price per `unit`
  isAvailable: boolean;
  // Catch-weight: final quantity is captured during preparation; cart total is an estimate.
  isVariableMeasure: boolean;
  // Units the customer may order in (includes the pricing unit).
  orderUnits: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
}

export interface MenuResponse {
  business: { id: string; name: string; currency: string };
  categories: MenuCategory[];
  items: MenuItem[];
}

// --- orders -----------------------------------------------------------------

export interface OrderItemDTO {
  id: string;
  productId: string | null;
  description: string;
  unit: string | null;
  quantityMilli: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  position: number;
}

export interface OrderStatusEvent {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string | null;
  source: string;
  createdAt: string;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  clientId: string;
  clientName: string | null;
  fulfillmentType: FulfillmentType;
  fulfillmentAt: string | null;
  orderDate: string | null;
  totalMinor: number;
  currency: string;
  placedByCustomer: boolean;
  itemCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderClient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface OrderDetail extends OrderSummary {
  client: OrderClient | null;
  deliveryAddress: string | null;
  notes: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxBps: number;
  taxMinor: number;
  deliveryChargeMinor: number;
  paidMinor: number;
  items: OrderItemDTO[];
  statusHistory: OrderStatusEvent[];
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- requests ---------------------------------------------------------------

export interface PlaceOrderItem {
  productId: string;
  quantity: string; // decimal string, e.g. "2" or "1.5"
  unit?: string; // order unit (must be allowed by the product); defaults to the pricing unit
}

export interface PlaceOrderRequest {
  items: PlaceOrderItem[];
  fulfillmentType: FulfillmentType;
  fulfillmentAt: string; // ISO 8601
  deliveryAddress?: string | null;
  notes?: string | null;
}

export interface UpdateStatusRequest {
  status: OrderStatus;
  reason?: string | null;
}

export interface InviteCustomerRequest {
  email: string;
  name?: string | null;
  phone?: string | null;
  clientId?: string | null;
}

export interface AcceptInvitationRequest {
  name: string;
  password: string;
  phone?: string | null;
}

// --- auth -------------------------------------------------------------------

export interface CustomerLoginRequest {
  email: string;
  password: string;
  businessId: string;
}

export interface CustomerAuthResponse {
  token: string;
  customer: { id: string; email: string; name: string; phone: string | null; businessId: string; clientId: string };
  business: { id: string; name: string; currency: string };
}

export interface AdminLoginRequest {
  email: string;
  password: string;
  businessId?: string | null;
}

export interface AdminAuthResponse {
  token: string;
  user: { id: string; email: string; name: string };
  activeBusinessId: string;
  workspaces: { businessId: string; name: string; role: string; suspended: boolean }[];
}

export interface InvitationPublic {
  id: string;
  email: string;
  name: string | null;
  businessName: string;
  expiresAt: string;
}

// --- realtime ---------------------------------------------------------------

export const REALTIME_EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_UPDATED: "order.updated",
  ORDER_STATUS_CHANGED: "order.status_changed",
  CONNECTED: "connected",
} as const;
export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export interface RealtimeOrderEvent {
  type: Exclude<RealtimeEventType, "connected">;
  order: OrderSummary | OrderDetail;
}
