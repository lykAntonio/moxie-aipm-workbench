import { handleRequest } from "../server/index.mjs";

export default function handler(req, res) {
  return handleRequest(req, res);
}
