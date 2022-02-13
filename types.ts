type StringOrNumber = number|string

// Full Order
export interface Billing {
  firstname: string;
  lastname: string;
  address_1: string;
  address_2: string;
  city: string;
  state_or_region: string;
  postcode_or_pobox: string;
  country: string;
  phone: string;
}

export interface Shipping {
  firstname: string;
  lastname: string;
  address_1: string;
  address_2: string;
  city: string;
  state_or_region: string;
  postcode_or_pobox: string;
  country: string;
  phone: string;
}

export interface Order {
  vendor: string;
  order_id: string;
  buyer_email: string;
  buyer_name: string;
  buyer_user_id: string;
  buyer_phone: string;
  gateway_buyer_uuid: string;
  amount: StringOrNumber;
  currency: string;
  payment_methods: string;
  redirect_url: string;
  cancel_url: string;
  webhook: string;
  billing: Billing;
  shipping: Shipping;
  buyer_remarks: string;
  merchant_remarks: string;
  no_of_items: StringOrNumber;
}

//
export interface OrderMinimal {
  vendor: string;
  order_id: string;
  buyer_email: string;
  buyer_name: string;
  buyer_phone: string;
  amount: StringOrNumber;
  currency: string;
  webhook: string;
  buyer_remarks: string;
  merchant_remarks: string;
  no_of_items: StringOrNumber;
}


// 