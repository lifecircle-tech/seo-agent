import { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't forward a rejected promise from an async handler to error
// middleware on its own — this wrapper catches it and calls next(err) for us.
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export { asyncHandler };
