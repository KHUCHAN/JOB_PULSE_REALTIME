import { it, expect } from "vitest";
import { crawlSanmina, sanminaPage } from "./sanmina-crawler";
const source = { id: "legacy-row-860", company: "Sanmina", postingUrl: "https://sanminacareers.mua.hrdepartment.com/hr/ats/JobSearch/viewAll", adapter: "custom" as const };
it("preserves inventory and reports the new official feed's blocking instead of an empty old catalog", async () => {
 const calls: string[]=[];
 const result=await crawlSanmina(source,async input=>{
  calls.push(String(input));return calls.length===1?new Response("There is no data to display."):new Response("challenge",{status:403});
 });
 expect(result).toMatchObject({status:"blocked",responseStatus:403,jobs:[],completeListing:false});
 expect(calls).toHaveLength(2);expect(calls[1]).toContain("jobs.sanmina.com/search/jobs.json");
});
it("continues to reject malformed legacy HTML rather than claiming authoritative zero",()=>{
 expect(()=>sanminaPage("<h1>View All Jobs</h1>",source)).toThrow("missing its range");
});
