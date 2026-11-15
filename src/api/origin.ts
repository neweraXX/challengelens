export function originAllowed(request: { protocol: string; get(name: string): string | undefined }): boolean {
  const origin = request.get("origin");
  return request.get("sec-fetch-site") !== "cross-site" && (!origin || origin === `${request.protocol}://${request.get("host")}`);
}
