import type { Response } from "express";

export function success(
  res: Response,
  data: unknown,
  status = 200
) {
  return res.status(status).json({
    ok: true,
    data,
  });
}

export function apiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  field?: string
) {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(field && { field }),
    },
  });
}