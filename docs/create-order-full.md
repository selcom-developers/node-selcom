# Create Order Full

```js
const data = {
  vendor: "12323232",
  order_id: "121212",
  buyer_email: "",
  buyer_name: "",
  buyer_user_id: "",
  buyer_phone: "",
  gateway_buyer_uuid: "",
  amount: 8000,
  currency: "TZS",
  payment_methods: "ALL",
  redirect_url: "URL",
  cancel_url: "URL",
  webhook: "URL",
  billing: {
    firstname: "John",
    lastname: "Doe",
    address_1: "969 Market",
    address_2: "",
    city: "San Francisco",
    state_or_region: "CA",
    postcode_or_pobox: "94103",
    country: "US",
    phone: "255682852526",
  },
  shipping: {
    firstname: "John",
    lastname: "Doe",
    address_1: "969 Market",
    address_2: "",
    city: "San Francisco",
    state_or_region: "CA",
    postcode_or_pobox: "94103",
    country: "US",
    phone: "255682852526",
  },
  buyer_remarks: "None",
  merchant_remarks: "None",
  no_of_items: 3,
};

fetch("https://apigw.selcommobile.com/v1/vcn/create", {
  method: "POST",
  body: JSON.stringify(data),
  headers: {
    Authorization: `SELCOM ${authorization}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Digest: digest,
    "Digest-Method": "HS256",
    "Signed-Fields":
      "vendor,order_id,buyer_email,buyer_name,buyer_user_id,buyer_phone,buyer_gateway_token,amount,currency,payment_methods,redirect_url,cancel_url,webhook,billing.firstname,billing.lastname,billing.address_1,billing.address_2,billing.city,billing.state_or_region,billing.postcode_or_pobox,billing.country,billing.email, billing.phone,shipping.firstname,shipping.lastname,shipping.address_1, shipping.address_2,shipping.city,shipping.state_or_region,shipping.country,shipping.email,shipping.phone,payer_remarks,merchant_remarks,order_items",
    Timestamp: "2019-02-26T09:30:46+03:00",
  },
})
  .then((res) => res.json())
  .then((res) => console.log(res))
  .catch((err) => console.log(err));
```

```json
{
  "reference": "0289999288",
  "resultcode": "000",
  "result": "SUCCESS",
  "message": "Order creation successful",
  "data": [
    {
      "gateway_buyer_uuid": "12344321",
      "payment_token": "80008000",
      "qr": "QR",
      "payment_gateway_url": "http:example.com/Ahesmey"
    }
  ]
}
```
