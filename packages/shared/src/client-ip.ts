/**
 * Header the API stamps with the client IP it resolved, for components that
 * need one but should not each re-derive it from the proxy chain.
 *
 * The API is the single place that decides which forwarded-IP headers are
 * trustworthy for a given deployment. It overwrites this header on every
 * request it stamps, so a value supplied by a client is always discarded.
 */
export const CLIENT_IP_HEADER = 'x-palouse-client-ip';
