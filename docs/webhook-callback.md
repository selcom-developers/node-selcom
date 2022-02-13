# Webhook Callback

Payment status callback api from payment gateway to ecommerce website.

```sh
curl "{thirdparty_site_webhook url}"
  -H "Authorization: SELCOM {authorization-token}"
  -H "Digest-Method: {digest-token}"
  -H "Digest: {digest}"
  -H "Timestamp: {timestamp in yyyy-dd-mm H:i:s format}"
  -H "Signed-Fields: transid,order_id,reference,result,resultcode,payment_status"
  -d '{"transid":"T123442", "reference":"028912121", "order_id":"123", "reference":"0281121212", "result":"SUCCESS", "resulcode":"000","payment_status":"COMPLETED"}
```


JSON payload from Selcom API
```json
{
  "transid":"T123442",
  "reference":"028912121",
  "order_id":"123",
  "reference":"0281121212",
  "result":"SUCCESS",
  "resulcode":"000",
  "payment_status":"COMPLETED"
}
```



```json
{

  "reference" : "0289999288",
  "resultcode" : "000",
  "result" : "PENDING",
  "message" : "Request in progress. You will receive a callback shortly.",
  "data": []
}
```
