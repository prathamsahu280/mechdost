-- Reason codes belong to their status (code review 2026-11-03). Written as NOT VALID + VALIDATE so that on a
-- large orders table the two statements can be run separately (the scan then does not block writes).
ALTER TABLE "orders" DROP CONSTRAINT "orders_reason_code_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reason_code_valid" CHECK (case "orders"."status"
        when 'rejected' then "orders"."status_reason_code" in ('no_stock_nearby','all_shops_declined','unserviceable_address','suspected_fraud','pricing_error','other')
        when 'cancelled' then "orders"."status_reason_code" in ('changed_mind','ordered_by_mistake','found_cheaper','delivery_too_slow','customer_unreachable','other')
        else "orders"."status_reason_code" is null end) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_reason_code_valid";
