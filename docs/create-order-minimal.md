# Create Order Minimal  


```js
const data = {
  vendor: "12323232",
  order_id: "121212",
  buyer_email: "john@example.com",
  buyer_name: "John Joh",
  buyer_phone: "255682XXXXXX",
  amount: 8000,
  currency: "TZS",
  webhook: "https://merchantdomain.com/process-order/121212",
  buyer_remarks: "None",
  merchant_remarks: "None",
  no_of_items: 1,
};

fetch("https://apigw.selcommobile.com/v1/vcn/create", {
  body: JSON.stringify(data),
  headers: {
    Authorization: "SELCOM {authorization-token}",
    "Content-Type": "application/x-www-form-urlencoded",
    Digest: "{digest}",
    "Digest-Method": "{digest-token}",
    "Signed-Fields":
      "vendor,order_id,buyer_email,buyer_name,buyer_user_id,buyer_phone,amount,currency,payment_methods,webhook,payer_remarks,merchant_remarks,order_items",
    Timestamp: "{timestamp in yyyy-dd-mm H:i:s format}",
  },
  method: "POST",
});

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
      "payment_gateway_url": "aHR0cDpleGFtcGxlLmNvbS9wZy90MTIyMjI="
    }
  ]
}

```