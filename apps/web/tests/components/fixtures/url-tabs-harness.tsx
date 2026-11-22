"use client";

import * as React from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";

export function UrlTabsHarness({
  controlled = false,
  lateAccessMs,
}: {
  controlled?: boolean;
  /** Render the Access tab only after this long, as a tab gated on
   * permissions that are still loading is. */
  lateAccessMs?: number;
}) {
  const [value, setValue] = React.useState("activity");
  const [showAccess, setShowAccess] = React.useState(
    lateAccessMs === undefined,
  );

  React.useEffect(() => {
    if (lateAccessMs === undefined) return;
    const timer = window.setTimeout(() => setShowAccess(true), lateAccessMs);
    return () => window.clearTimeout(timer);
  }, [lateAccessMs]);

  return (
    <Tabs
      {...(controlled
        ? { value, onValueChange: setValue }
        : { defaultValue: "activity" })}
      urlParam="tab"
    >
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="config">Configuration</TabsTrigger>
        {showAccess && <TabsTrigger value="access">Access</TabsTrigger>}
      </TabsList>
      <TabsContent value="activity">Activity content</TabsContent>
      <TabsContent value="config">Configuration content</TabsContent>
      {showAccess && <TabsContent value="access">Access content</TabsContent>}
    </Tabs>
  );
}
