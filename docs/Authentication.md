# Authentication

Selcom uses API key and API secret to allow access to the API. You can request for api credentials writing to Selcom Support.

Selcom API Gateway expects the below HTTP headers to be included in all API requests to the server for both GET and POST requests:

| Header        | Description                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | Base64 encoded API key using realm SELCOM                                                                                                                                                      |
| Timestamp     | Datetime in ISO 8601 date format (YYYY-MM-DDThh:mmTZD). Example `2019-02-26T09:30:46+03:00 `                                                                                                   |
| Digest-Method | `HS256` for HMAC SHA256 algorithm , `RS256` for RSA signature with PKCS #1 and SHA-2                                                                                                           |
| Digest        | Base64 encoded HMAC SHA256 or RSA signature of data in the format (timestamp=[timezone as in header 2019-02-26T09:30:46+03:00]&field1=value1&fielf...in the order defined in Signed-Fields)    |
| Signed-Fields | GET or POST Json parameters keys comma separated in the same order used for computing Digest. (Timestamp field need not be mentioned on Signed-fields header through its part of the signing). |

Refer to the below example

- `Authorization:` SELCOM MjAyY2I5NjJhYzU5MDc1Yjk2NGIwNzE1MmQyMzRiNzA=
- `Digest-Method:` HS256
- `Digest:` tW32A+O1FcpRj2o2mbWgF2r+**vmILqqKwHqDryj**+7lvI=
- `Timestamp:` 2019-02-26T09:30:46+03:00
- `Signed-Fields:` utilitycode,utilityref,vendor,pin,transid,amount

## Example

> To authorize, use this code:

With shell, you can just pass the correct header with each request

```sh
curl "api_endpoint_here"
  -H "Content-type: application/json"
  -H "Authorization: SELCOM meowmeowmeow"
  -H "Digest-Method: HS256"
  -H "Digest: tW32A+O1FcpRj2o2mbWgF2r+vmILqqKwHqDryj+7lvI="
  -H "Timestamp: 2019-02-26T09:30:46+03:00"
  -H "Signed-Fields: utilityref,vendor,pin,transid,amount,msisdn"
  -d  '{"vendor":"BANKX", "pin":"3333", "utilityref":"075XXXXXXX", "transid":"T001", "amount":"1234", "msisdn":"25568XXXXXXX"}'

```

> Make sure to replace other header values with the appropriate values computed before sending the request.

## API Response

> API responses for failure scenario

```json
{
  "transid": "F10001",
  "reference": "0289999288",
  "resultcode": "403",
  "result": "FAIL",
  "message": "No reponse from upstream system",
  "data": []
}
```

> API responses for Success scenario

```json
{
  "transid": "F10002",
  "reference": "0270720833",
  "resultcode": "000",
  "result": "SUCCESS",
  "message": "Airtime recharge\nReference 0270720833\nPhone 0773820XXX\nAmount TZS 10,000\nVendor XYZVENDOR\n\nPowered by Selcom",
  "data": []
}
```

| Result     | Errorcode  | Description                                                                      |
| ---------- | ---------- | -------------------------------------------------------------------------------- |
| SUCCESS    | 000        | Transaction successful                                                           |
| INPROGRESS | 111,927    | Transaction in progress please query to know the exact status of the transaction |
| AMBIGOUS   | 999        | Transactions status unknown wait for recon                                       |
| FAIL       | All others | Transaction failed                                                               |

Incase of an `INPROGRESS` and `AMGIBOUS` error code scenario, do a transaction query status api after 3 mins interval if the status remain the same, transaction should be cleared after a manual recon with Selcom Recon team ([recon_at_selcom_dot_net](recon_at_selcom_dot_net))
