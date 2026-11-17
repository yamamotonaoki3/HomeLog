import {Hono} from 'hono'
import {drizzle} from 'drizzle-orm/d1'
import {requireAuth} from '../middleware/auth'
import {resolveHouseholdId} from '../lib/household-context'
import {menuLinkUpdateSchema,updateMenuLink} from '../lib/inventory-menu-links'
import {errorResponse} from '../lib/errors'
import type {AppEnv} from '../index'
export const inventoryMenuLinksRoute=new Hono<AppEnv>()
inventoryMenuLinksRoute.use('*',requireAuth)
inventoryMenuLinksRoute.patch('/:id',async c=>{
 let body:unknown
 try{body=await c.req.json()}catch{body=null}
 const parsed=menuLinkUpdateSchema.safeParse(body),id=Number(c.req.param('id'))
 if(!parsed.success||!Number.isSafeInteger(id)||id<1)return c.json(errorResponse('VALIDATION_ERROR','入力内容を確認してください'),400)
 const householdId=await resolveHouseholdId(drizzle(c.env.DB),c.get('userId'))
 if(householdId===null)return c.json(errorResponse('RESOURCE_NOT_FOUND','世帯グループが見つかりません'),404)
 const result=await updateMenuLink(c.env.DB,householdId,id,parsed.data)
 return new Response(JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json'}})
})
