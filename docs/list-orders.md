# List All Orders

HTTP Request
GET http://example.com/v1/checkout/list-orders?fromdate={YYYY-MM-DD}&todate={YYYY-MM-DD}

Below sample response:

```json
{
  "reference" : "0289999288",
  "resultcode" : "000",
  "result" : "SUCCESS",
  "message" : "Order fetch successful",
  "data": [
  	{
  		"order_id":"123",
  		"creation_date":"2019-06-06 22:00:00",
  		"amount":"1000",
  		"payment_status":"PENDING"
  	},
  	{
  		"order_id":"124",
  		"creation_date":"2019-06-06 22:10:00",
  		"amount":"2000",
  		"payment_status":"CANCEL"
  	}
  ]
}
```