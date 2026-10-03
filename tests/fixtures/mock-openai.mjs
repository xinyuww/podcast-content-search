// Only loaded by the production HTTP integration test, never by application code.
import { readFileSync } from "node:fs";
if (process.env.PODCAST_TEST_PROVIDER !== "1") throw new Error("Test provider requires explicit test opt-in");
const fixtures = JSON.parse(readFileSync(new URL("./retrieval-parity.json", import.meta.url)));
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target === "https://api.openai.com/v1/embeddings") return Response.json({model:"text-embedding-3-small",data:[{index:0,embedding:fixtures[0].vector}]});
  if (target === "https://api.openai.com/v1/responses") {
    const body = JSON.parse(init.body);
    const turn = {assistant_message:"你想了解编程。",next_question:null,need:{
      situation:"",need_summary:"想了解编程",search_query:"编程概念入门",
      preferences:{topics:[],help_types:[],formats:[],avoid_help_types:[],avoid_formats:[]},
      unresolved:[],ready_to_recommend:true,
      evidence:[{field:"need_summary",label:"",message_id:"u1",quote:"想了解编程",basis:"explicit"}],
    }};
    if (body.store !== false) throw new Error("Conversations must not be stored");
    return Response.json({status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(turn)}]}]});
  }
  return original(url, init);
};
