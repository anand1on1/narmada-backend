// R26.3: minimal ambient declaration for connect-sqlite3 (ships no types).
declare module "connect-sqlite3" {
  import session from "express-session";
  function connectSqlite3(s: typeof session): new (options?: {
    db?: string;
    dir?: string;
    table?: string;
    concurrentDB?: boolean;
  }) => session.Store;
  export default connectSqlite3;
}
