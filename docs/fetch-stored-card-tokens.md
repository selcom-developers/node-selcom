# Fetch Stored Card Tokens

This API allows the eCommerce website to fetch stored cards for specific user passing the gateway_buyer_uuid that was generated for each user on there first order creation.

HTTP Request
GET http://example.com/v1/checkout/stored-cards?gateway_buyer_uuid={gateway_buyer_uuid}&buyer_userid={buyer_userid}

```json
{
  "reference": "0289999288",
  "resultcode": "000",
  "result": "SUCCESS",
  "message": "Order fetch successful",
  "data": [
    {
      "masked_card": "5555-12XX-XXXX-1234",
      "creation_date": "2019-06-06 22:00:00",
      "card_token": "ABC123423232",
      "name": "JOE JOHN",
      "card_type": "001"
    },
    {
      "masked_card": "5555-12XX-XXXX-4321",
      "creation_date": "2019-06-06 23:00:00",
      "card_token": "ABC123423244",
      "name": "JOE JOHN",
      "card_type": "001"
    }
  ]
}
```
