/** An error whose message is safe to show to the client, with the HTTP status to return. */
export class ClientError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
