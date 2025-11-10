import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { debugConfig } from "../../env";

export default function LayoutAddition() {
  if (!debugConfig.isEnabled()) return null;
  return <ReactQueryDevtools buttonPosition="bottom-right" />;
}
