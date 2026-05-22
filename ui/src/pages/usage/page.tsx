import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BudgetsPage from "@/pages/budgets/page";
import { UsageContent } from "@/pages/usage/usage-content";

type UsageTab = "usage" | "budgets";

export default function UsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: UsageTab = searchParams.get("tab") === "budgets" ? "budgets" : "usage";

  function handleTabChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "budgets") {
          next.set("tab", "budgets");
        } else {
          next.delete("tab");
        }
        return next;
      },
      { replace: true },
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="flex flex-col flex-1 min-h-0 gap-4"
    >
      <TabsList variant="line">
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="budgets">Budgets</TabsTrigger>
      </TabsList>
      <TabsContent value="usage" className="flex flex-col flex-1 min-h-0">
        <UsageContent />
      </TabsContent>
      <TabsContent value="budgets" className="flex flex-col flex-1 min-h-0">
        <BudgetsPage />
      </TabsContent>
    </Tabs>
  );
}
