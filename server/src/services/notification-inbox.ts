import { and, asc, eq, gt, gte, inArray, or, sql } from "drizzle-orm";
import { activityLog, companies, companyMemberships, type Db } from "@paperclipai/db";
import { z } from "zod";
import { badRequest } from "../errors.js";
import { workNotification } from "./work-notification.js";

const cursorSchema=z.object({at:z.string().datetime(),id:z.string().uuid()});
export async function listNotificationInbox(db:Db,userId:string,cursor?:string) {
 let after={at:new Date(Date.now()-24*60*60*1000).toISOString(),id:"00000000-0000-4000-8000-000000000000"};
 if(cursor){
  try{if(cursor.length>256)throw Error();after=cursorSchema.parse(JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")));}
  catch{throw badRequest("Invalid notification cursor");}
 }
 // Preserve PostgreSQL microseconds in the keyset cursor. JS Date truncates to
 // milliseconds and would replay the last row forever when it has finer precision.
 const rows=await db.select({id:activityLog.id,companyId:activityLog.companyId,action:activityLog.action,entityType:activityLog.entityType,entityId:activityLog.entityId,details:activityLog.details,createdAtCursor:sql<string>`to_char(${activityLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,prefix:companies.issuePrefix})
  .from(activityLog)
  .innerJoin(companies,and(eq(companies.id,activityLog.companyId),eq(companies.status,"active")))
  .innerJoin(companyMemberships,and(eq(companyMemberships.companyId,activityLog.companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,userId),eq(companyMemberships.status,"active")))
  .where(and(eq(activityLog.responsibleUserId,userId),inArray(activityLog.action,["issue.updated","approval.created","approval.resubmitted"]),gte(activityLog.createdAt,new Date(Date.now()-24*60*60*1000)),or(sql`${activityLog.createdAt} > ${after.at}::timestamptz`,and(sql`${activityLog.createdAt} = ${after.at}::timestamptz`,gt(activityLog.id,after.id)))))
  .orderBy(asc(activityLog.createdAt),asc(activityLog.id)).limit(100);
 const items=rows.flatMap(row=>{
  const n=workNotification(row);
  if(!n||!/^[-A-Za-z0-9_]+$/.test(row.prefix)||!/^[-A-Za-z0-9_]+$/.test(row.entityId))return [];
  return [{id:row.id,companyId:row.companyId,kind:n.kind,title:n.title,body:n.body,path:`/${row.prefix}/${n.route}/${row.entityId}`}];
 });
 const last=rows.at(-1);
 return {userId,items,cursor:Buffer.from(JSON.stringify(last?{at:last.createdAtCursor,id:last.id}:after)).toString("base64url"),hasMore:rows.length===100};
}
