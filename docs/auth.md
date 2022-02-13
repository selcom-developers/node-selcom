# Auth

```js
function sendJSONPost(url, json, authorization, digest, signed_fields, timestamp) {
    const headers = {
      "Content-type: application/json;charset=\"utf-8\"",
      "Accept: application/json",
      "Cache-Control: no-cache",
      "Authorization: SELCOM $authorization",
      "Digest-Method: HS256",
      "Digest: $digest",
      "Timestamp: $timestamp",
      "Signed-Fields: $signed_fields",
    };
    // send request
    const result = axions.post(url, headers, json);
    return JSON.parse(result, true);

 }

 function computeSignature(parameters, signed_fields, request_timestamp, api_secret){
    const fields_order = explode(',', $signed_fields);
    const sign_data = "timestamp=$request_timestamp";
    foreach ($fields_order as $key) {
      sign_data += "&$key=" + $parameters[$key];
    }

    // Calculate  HS256 Signature Method
    return base64_encode(hash_hmac('sha256', $sign_data, $api_secret, true));
 }

//Set your appropirate timezone
// date_default_timezone_set('Africa/Dar_es_Salaam');

const api_key = '202cb962ac59075b964b07152d234b70';
const api_secret = '81dc9bdb52d04dc20036dbd8313ed055';

const base_url = "http://127.0.0.1/selcom-api-gateway/v1";
const api_endpoint = "/utilitypayment/process";
const url = base_url + api_endpoint;


const req = {"utilityref": "12345", "transid": "transid", "amount": "amount"};
const authorization = Buffer.from(ape_key).to('hex') //  base64_encode($api_key);

const timestamp = '2019-02-26T09:30:46+03:00' // date('c');

$signed_fields  = implode(',', array_keys($req));

const digest = computeSignature(req, signed_fields, timestamp, api_secret);

const response = await sendJSONPost(url, req, authorization, digest, signed_fields, timestamp);


```
