/** Which "paid" sentence a service bill gets: the Razorpay payment is "online"; cash, UPI and card were taken at the workshop. */
export function billPaidKey(method: string | null): 'billPaid' | 'billPaidOnline' {
  return method === 'online' ? 'billPaidOnline' : 'billPaid';
}
