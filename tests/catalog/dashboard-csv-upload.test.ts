import { afterEach,describe,expect,it,vi } from "vitest";
const { request }=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../../client/src/lib/admin-auth",()=>({adminFetch:request}));
import { readCsvStream,streamCsvFile,csvComplete,csvJson,readCsvCheckpoint,writeCsvCheckpoint,CSV_MAX_BYTES } from "../../client/src/lib/price-csv-upload";
afterEach(()=>{vi.unstubAllGlobals();request.mockReset();});
const completed={event:"complete",upload_id:7,state:"complete",staged_rows:262489,publication:{autoSync:true,job:{id:8,state:"waiting_fx"}}};
const response=(body:string,status=200,type="application/x-ndjson")=>new Response(body,{status,headers:{"Content-Type":type}});
describe("dashboard CSV streaming contract",()=>{
  it("does not treat HTTP 200 validation error or a missing terminal event as success",async()=>{
    await expect(readCsvStream(response('{"event":"error","error":"Invalid utf-8 byte at offset 20, CSV record 2, column description."}\n'),()=>{})).rejects.toThrow("Invalid utf-8");
    await expect(readCsvStream(response('{"event":"progress","state":"streaming","staged_rows":500}\n'),()=>{})).rejects.toThrow("without a completion event");
    await expect(readCsvStream(response('{"state":"failed"}',200,"application/json"),()=>{})).rejects.toThrow("did not complete");
    await expect(readCsvStream(response("<html>Proxy error</html>",200,"text/html"),()=>{})).rejects.toThrow("Unexpected CSV response");
  });
  it("reads split NDJSON and UTF-8 boundaries, including final line without newline",async()=>{
    const bytes=new TextEncoder().encode(JSON.stringify({event:"progress",state:"streaming",label:"₹",staged_rows:500})+"\n"+JSON.stringify(completed));
    const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}});
    const progress=vi.fn();
    expect(await readCsvStream(new Response(stream,{headers:{"Content-Type":"application/x-ndjson"}}),progress)).toMatchObject({state:"complete",staged_rows:262489});
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it("accepts authoritative already-complete JSON but rejects contradictory or oversized events",async()=>{
    expect(await readCsvStream(response(JSON.stringify({...completed,alreadyComplete:true}),200,"application/json"),()=>{})).toMatchObject({alreadyComplete:true});
    await expect(readCsvStream(response('{"event":"complete","state":"failed"}\n'),()=>{})).rejects.toThrow("could not be verified");
    await expect(readCsvStream(response("x".repeat(65537)),()=>{})).rejects.toThrow("safe limit");
  });
  it("sends File/Blob directly with existing admin auth wrapper, never parses or sets Content-Length",async()=>{
    const file=new Blob(["part_number,mrp\n000-A,835\n"],{type:"text/csv"}) as File;
    vi.spyOn(file,"arrayBuffer").mockRejectedValue(Error("Must not materialize CSV"));
    request.mockResolvedValue(response(JSON.stringify(completed)+"\n"));
    await streamCsvFile("fixture",7,file,()=>{});
    expect(request).toHaveBeenCalledWith("fixture","/api/admin/catalog-sync/csv-imports/7/content",{
      method:"PUT",headers:{"Content-Type":"text/csv"},body:file,redirect:"error",credentials:"omit",
    });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it("shows authentication errors and does not hide server rate/conflict errors",async()=>{
    request.mockResolvedValue(response('{"error":"Unauthorized"}',401,"application/json"));
    await expect(csvJson("expired","/status")).rejects.toThrow("authorized admin account");
    await expect(readCsvStream(response('{"error":"Another large CSV stream is active"}',409,"application/json"),()=>{})).rejects.toThrow("Another large CSV stream");
    await expect(readCsvStream(response('{"error":"Wait five seconds"}',429,"application/json"),()=>{})).rejects.toThrow("Wait five seconds");
  });
  it("distinguishes imported rows, waiting-FX publication, sync-disabled and unknown publication state",()=>{
    expect(csvComplete(completed as any)).toMatch(/waiting_fx.*not confirmation that prices are live/);
    expect(csvComplete({...completed,publication:{autoSync:false,rows:1,job:null}} as any)).toContain("no publication job was created");
    expect(csvComplete({...completed,publication:undefined} as any)).toContain("completion alone does not mean prices are live");
  });
  it("persists only resume metadata, rejects invalid checkpoints and tolerates unavailable storage",()=>{
    const store=new Map<string,string>();
    vi.stubGlobal("localStorage",{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)});
    const value={id:7,fileName:"price-list.csv",bytes:19276411};writeCsvCheckpoint(value);
    expect(readCsvCheckpoint()).toEqual(value);
    writeCsvCheckpoint({...value,bytes:CSV_MAX_BYTES+1});expect(readCsvCheckpoint()).toBeNull();
    writeCsvCheckpoint(null);expect(readCsvCheckpoint()).toBeNull();
    vi.stubGlobal("localStorage",{getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");}});
    expect(readCsvCheckpoint()).toBeNull();expect(()=>writeCsvCheckpoint(value)).not.toThrow();
  });
});
