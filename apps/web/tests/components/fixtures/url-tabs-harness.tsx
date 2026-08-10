"use client";

import * as React from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";

export function UrlTabsHarness({ controlled = false }: { controlled?: boolean }) {
  const [value, setValue] = React.useState("activity");

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
      </TabsList>
      <TabsContent value="activity">Activity content</TabsContent>
      <TabsContent value="config">Configuration content</TabsContent>
    </Tabs>
  );
}
