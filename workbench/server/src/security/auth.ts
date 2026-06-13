export function getServerToken(): string {
  const token = process.env.WORKBENCH_TOKEN
  if (token && token.length > 0) return token
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WORKBENCH_TOKEN is required in production')
  }
  return 'dev-token'
}

export function verifyBearerToken(authHeader: string | undefined): boolean {
  return authHeader === `Bearer ${getServerToken()}`
}
