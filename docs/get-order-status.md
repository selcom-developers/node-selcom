# Get Order Status | Get status of an order.

HTTP Request

GET http://example.com/v1/checkout/order-status?order_id={order_id}

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
  	 	"payment_status":"PENDING",
  	 	"transid":null,
  		"channel":null,
  		"reference":null,
		"phone":null
	}
  ]
}
