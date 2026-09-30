/**
 * Proxies between a client and this process: the value main.ts gives Express's
 * `trust proxy`.
 *
 * Exactly one in every deployed environment. The API hostname resolves straight to an AWS
 * Application Load Balancer, and the ECS task runs Node with nothing in front of it, so the
 * TCP peer Express sees is always the load balancer. The balancer appends the address it
 * accepted the connection from to X-Forwarded-For (its default mode). Trusting one hop makes
 * `req.ip` that address, and anything a client wrote into the header itself sits further
 * left and is ignored.
 *
 * Unset, `req.ip` was the load balancer's own address: every IP-keyed rate limit counted all
 * clients as one, and the audit logs recorded the balancer instead of the caller. Never set
 * `trust proxy` to `true`. That trusts the whole header, so any caller could choose its own
 * `req.ip`, and with it a fresh rate-limit bucket per request. Change this number only when
 * the network path in front of the service changes.
 */
export const TRUSTED_PROXY_HOPS = 1;
