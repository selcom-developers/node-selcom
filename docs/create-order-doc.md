## Create Order

Create a new order post checkout from your ecommerce website. Card payments with no billing info will get rejected. Note: All urls in the request and response are base64 encoded.

### HTTP Request

`POST http://example.com/v1/checkout/create-order`

### JSON Payload Parameters

| Parameter                  | Type      | Example              | Description                                                                                                                    |
| -------------------------- | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| vendor                     | Mandatory | SHOP203              | Vendor/Merchant ID allocated by Selcom                                                                                         |
| order_id                   | Mandatory | 123                  | Order id that uniquely identifies the order                                                                                    |
| buyer_email                | Mandatory | customer@example.com | Buyer email                                                                                                                    |
| buyer_name                 | Mandatory | Joe John             | Buyer's full name                                                                                                              |
| buyer_userid               | Option    | joejohn20            | Buyers unique user-id in the thridparty ecommerce website. Should be empty for guest check                                     |
| buyer_phone                | Mandatory | 255781234XXX         | Buyers msisdn                                                                                                                  |
| gateway_buyer_uuid         | Option    | A1233232             | Used to display stored card in the payment process. The field is returned first time the user creates an order                 |
| amount                     | Mandatory | 5000                 | Order amount                                                                                                                   |
| currency                   | Mandatory | TZS                  | International currency code TZS, USD                                                                                           |
| payment_methods            | Mandatory | ALL                  | Has to be comma separated list of ALL, MASTERPASS, CARD, MOBILEMONEYPULL                                                       |
| redirect_url               | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded thirdparty ecommerce page url that the customer should be redirected after payment process is complete          |
| cancel_url                 | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded thirdparty ecommerce page url that the customer should be redirected when payment process canceled by the buyer |
| webhook                    | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded webhook callback url to recieve API call back of the payment status                                             |
| billing.firstname          | Mandatory | Joe                  | First name - Payment Billing info                                                                                              |
| billing.lastname           | Mandatory | John                 | Last name - Payment Billing info                                                                                               |
| billing.address_1          | Mandatory | 23, street X         | Address 1 - Payment Billing info                                                                                               |
| billing.address_2          | Optional  | Upanga Area          | Address 2 - Payment Billing info                                                                                               |
| billing.city               | Mandatory | Dar es salaam        | City - Payment Billing info                                                                                                    |
| billing.state_or_region    | Mandatory | Dar es Salaam        | Region - Payment Billing info                                                                                                  |
| billing.postcode_or_pobox  | Mandatory | 43434                | PO Box- Payment Billing info                                                                                                   |
| billing.country            | Mandatory | TZ                   | International Country code - Payment Billing info                                                                              |
| billing.phone              | Mandatory | 25578123XXXX         | Phone - Payment Billing info                                                                                                   |
| shipping.firstname         | Optional  | Joe                  | First name - Payment Billing info                                                                                              |
| shipping.lastname          | Optional  | John                 | Last name - Payment Billing info                                                                                               |
| shipping.address_1         | Optional  | 23, street X         | Address 1 - Payment Billing info                                                                                               |
| shipping.address_2         | Optional  | Upanga Area          | Address 2 - Payment Billing info                                                                                               |
| shipping.city              | Optional  | Dar es salaam        | City - Payment Billing info                                                                                                    |
| shipping.state_or_region   | Optional  | Dar es Salaam        | Region - Payment Billing info                                                                                                  |
| shipping.postcode_or_pobox | Optional  | 43434                | PO Box- Payment Billing info                                                                                                   |
| shipping.country           | Optional  | TZ                   | International Country code - Payment Billing info                                                                              |
| shipping.phone             | Optional  | 25578123XXXX         | Phone - Payment Billing info                                                                                                   |
| buyer_remarks              | Optional  | 255781234567         | Payer remark/decription for the order                                                                                          |
| merchant_remarks           | Optional  | 255781234567         | Buyer remark/decription for the order                                                                                          |
| no_of_items                | Mandatory | 255781234567         | No of items in the order                                                                                                       |
| header_colour              | Optional  | #FF0012              | Payment gateway page header colour                                                                                             |
| link_colour                | Optional  | #FF0012              | Payment gateway page link text colour                                                                                          |
| button_colour              | Optional  | #FF0012              | Payment gateway page button colour                                                                                             |

|

## Examples

<!-- WIP -->

## Responses

<!-- WIP -->
