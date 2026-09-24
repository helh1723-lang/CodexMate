import type { Store } from '../store/index.js';
import { assert } from '../core/model.js';
export interface Lease {key:string;holder:string;fence:number;expires:number;stopped:number;}
export class LeaseStore {
  constructor(private store:Store,private clock=Date.now){}
  acquire(key:string,holder:string,ttl=60000):Lease {
    return this.store.transaction(()=>{
      const old=this.get(key);
      // Expiry alone never proves an old writer has stopped. Reassignment requires explicit stop acknowledgement.
      assert(!old||old.stopped===1,'LEASE_BUSY','旧 Worker 尚未确认停止，禁止接管。');
      const lease={key,holder,fence:(old?.fence??0)+1,expires:this.clock()+ttl,stopped:0};
      this.store.db.prepare('INSERT INTO leases VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET holder=excluded.holder,fence=excluded.fence,expires=excluded.expires,stopped=0').run(key,holder,lease.fence,lease.expires,0);
      return lease;
    });
  }
  get(key:string):Lease|undefined{return this.store.db.prepare('SELECT * FROM leases WHERE key=?').get(key) as unknown as Lease|undefined;}
  validate(key:string,holder:string,fence:number){const l=this.get(key);assert(l&&l.holder===holder&&l.fence===fence&&!l.stopped&&l.expires>this.clock(),'STALE_FENCE','租约无效或过期，已阻止受管写入。');return l;}
  renew(key:string,holder:string,fence:number,ttl=60000){return this.store.transaction(()=>{this.validate(key,holder,fence);this.store.db.prepare('UPDATE leases SET expires=? WHERE key=?').run(this.clock()+ttl,key);return this.get(key)!;});}
  stop(key:string,holder:string,fence:number){return this.store.transaction(()=>{const l=this.get(key);assert(l&&l.holder===holder&&l.fence===fence,'STALE_FENCE','旧 fencing token 无法停止新租约。');this.store.db.prepare('UPDATE leases SET stopped=1 WHERE key=?').run(key);});}
}
