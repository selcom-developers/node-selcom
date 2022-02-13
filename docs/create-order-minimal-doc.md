# Create Order - Minimal

Create a new order post checkout from your eCommerce website for non-card payments. This api cannot be used for card payments. Card payment option wont be displayed on the payment gateway page after redirection. Ideal for mobile wallet push payments and manual payments when merchant is capable of presenting the payment token or qr code to the customer. Note: All urls in the request and response are base64 encoded.

### HTTP Request

`POST http://example.com/v1/checkout/create-order-minimal`


### JSON Payload Parameters

| Parameter        | Type      | Example              | Description                                                                                                                    |
| ---------------- | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| vendor           | Mandatory | SHOP203              | Vendor/Merchant ID allocated by Selcom                                                                                         |
| order_id         | Mandatory | 123                  | Order id that uniquely identifies the order                                                                                    |
| buyer_email      | Mandatory | customer@example.com | Buyer email                                                                                                                    |
| buyer_name       | Mandatory | Joe John             | Buyer's full name                                                                                                              |
| buyer_phone      | Mandatory | 255781234XXX         | Buyers msisdn                                                                                                                  |
| amount           | Mandatory | 5000                 | Order amount                                                                                                                   |
| currency         | Mandatory | TZS                  | International currency code TZS, USD                                                                                           |
| redirect_url     | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded thirdparty ecommerce page url that the customer should be redirected after payment process is complete          |
| cancel_url       | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded thirdparty ecommerce page url that the customer should be redirected when payment process canceled by the buyer |
| webhook          | Optional  | aHR0cDovL3VybC5jb20= | Base64 encoded webhook callback url to recieve API call back of the payment status.                                            |
| buyer_remarks    | Optional  | 255781234567         | Payer remark/decription for the order                                                                                          |
| merchant_remarks | Optional  | 255781234567         | Buyer remark/decription for the order                                                                                          |
| no_of_items      | Mandatory | 255781234567         | No of items in the order (No of product times no items)                                                                        |
| header_colour    | Optional  | #FF0012              | Payment gateway page header colour                                                                                             |
| link_colour      | Optional  | #FF0012              | Payment gateway page link text colour                                                                                          |
| button_colour    | Optional  | #FF0012              | Payment gateway page button colour                                                                                             |
| expiry           | Optional  | 60                   | Expiry in minutes                                                                                                              |

## Examples
<!-- WIP -->


## Responses
<!-- WIP -->