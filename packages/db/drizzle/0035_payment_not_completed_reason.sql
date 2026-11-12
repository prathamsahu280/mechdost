-- Online orders cancelled by the system when the payment window ends (Razorpay, plan 2026-11-12).
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_reason_code_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reason_code_valid" CHECK (case "orders"."status"
        when 'rejected' then "orders"."status_reason_code" in ('no_stock_nearby','all_shops_declined','unserviceable_address','suspected_fraud','pricing_error','other')
        when 'cancelled' then "orders"."status_reason_code" in ('changed_mind','ordered_by_mistake','found_cheaper','delivery_too_slow','customer_unreachable','payment_not_completed','other')
        else "orders"."status_reason_code" is null end);