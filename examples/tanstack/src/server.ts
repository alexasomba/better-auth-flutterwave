import handler from "@tanstack/react-start/server-entry";
import { auth, flutterwaveOptions, usesPersistentDatabase } from "./lib/auth";
import { runBillingSchedule } from "./lib/billing-schedule";

export default {
  fetch: handler.fetch,
  async scheduled(controller: { scheduledTime: number }) {
    return runBillingSchedule(
      controller.scheduledTime,
      { auth, flutterwaveOptions },
      usesPersistentDatabase,
    );
  },
};
