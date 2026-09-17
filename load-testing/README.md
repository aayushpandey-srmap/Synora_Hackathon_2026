# Load testing

Install [k6](https://k6.io), then run `k6 run load-testing/auctions.js`.
Set `BASE_URL` to the deployed HTTPS URL and provide an authenticated
`AUTH_COOKIE` when testing bid placement. Scenarios are deliberately
conservative; raise VUs only against an isolated environment.

```sh
BASE_URL=https://auction.example.com k6 run load-testing/auctions.js
```
