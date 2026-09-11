export function validateSmokeTarget(baseUrl, publicBaseUrl, token) {
  if (
    baseUrl !== 'http://127.0.0.1:18081' ||
    !/^https:\/\/[a-z0-9.-]+$/.test(publicBaseUrl) ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error('DP06_INTERNAL_TARGET_OR_CREDENTIAL_INVALID');
}
