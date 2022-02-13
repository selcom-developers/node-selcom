import fetch from "node-fetch";
import crypto from "crypto";
import Buffer from "buffer";

/**
 * Send JSON Post Request using SELCOM Authorization
 * @param url
 * @param json
 * @param authorization
 * @param digest
 * @param signedFields
 * @param timestamp
 * @returns
 */
function sendJSONPost(
  url: string,
  json: unknown,
  authorization: string,
  digest: string,
  signedFields: string,
  timestamp: string
) {
  const headers = {
    "Content-type": 'application/json;charset="utf-8"',
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "Digest-Method": "HS256",
    Authorization: `SELCOM ${authorization}`,
    Digest: digest,
    Timestamp: timestamp,
    "Signed-Fields": signedFields,
  };

  return fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(json),
  }).then((res) => res.json());
}

/**
 * Compute Signature for a given message
 *
 * @param parameters
 * @param signedFields
 * @param timestamp
 * @param apiSecret
 * @returns
 */
function computeSignature(
  parameters: unknown,
  signedFields: string,
  timestamp: string,
  apiSecret: string
) {
  const fields_order = signedFields.split(",");
  let sign_data = `timestamp=${timestamp}`;

  fields_order.forEach((element) => {
    sign_data += `&${element}=${parameters[element]}`;
  });

  // Calculate  HS256 Signature Method
  const hmac = crypto.createHmac("sha256", apiSecret);
  hmac.update(sign_data);
  const signature = hmac.digest("base64");
  return signature;
}

// set timezone nodejs
// process.env.TZ = 'Africa/Dar_es_Salaam';

const apiKey = "202cb962ac59075b964b07152d234b70";
const apiSecret = "81dc9bdb52d04dc20036dbd8313ed055";

const baseUrl = "http://127.0.0.1/selcom-api-gateway/v1";
const apiEndpoint = "/utilitypayment/process";
const url = baseUrl + apiEndpoint;

const requestParameters = {
  utilityref: "12345",
  transid: "transid",
  amount: "5000",
};

const authorization = Buffer.Buffer.from(apiKey).toString("hex");

//  timestamp in this format 2019-02-26T09:30:46+03:00
const timestamp = new Date().toISOString(); // 2022-02-13T07:57:50.255Z

const signedFields = Object.keys(requestParameters).join(",");

const digest = computeSignature(
  requestParameters,
  signedFields,
  timestamp,
  apiSecret
);

const response = sendJSONPost(
  url,
  requestParameters,
  authorization,
  digest,
  signedFields,
  timestamp
);

console.log(response);
