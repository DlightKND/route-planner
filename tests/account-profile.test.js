// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest';
import {initials,openAccountProfile} from '../src/account-profile.js';
afterEach(()=>document.body.replaceChildren());
const options=()=>({profile:{full_name:'Анна <img src=x onerror=alert(1)>',role:'engineer'},user:{email:'anna@example.invalid'},readOrg:async()=>({job_title:'Инженер',manager:null,reports:[]}),logout:vi.fn(),settings:vi.fn()});
it('escapes profile and hierarchy text and uses initials when no image exists',async()=>{
 const o=options();o.readOrg=async()=>({manager:{full_name:'<script>alert(1)</script>',role:'logist'},reports:[]});
 const d=openAccountProfile(o);await Promise.resolve();expect(d.querySelector('.account-identity').textContent).toContain('<img');expect(d.querySelector('img,script')).toBeNull();expect(d.querySelector('.account-org').textContent).toContain('<script>');expect(initials(' Анна Смирнова ')).toBe('АС');
});
it('calls sign out and personal settings only on explicit actions',()=>{
 const o=options(),d=openAccountProfile(o);expect(o.logout).not.toHaveBeenCalled();d.querySelector('[data-profile-settings]').click();expect(o.settings).toHaveBeenCalledTimes(1);expect(o.logout).not.toHaveBeenCalled();
 const next=openAccountProfile(o);next.querySelector('[data-profile-logout]').click();expect(o.logout).toHaveBeenCalledTimes(1);expect(next.open).toBe(false);
});
it('does not write an asynchronous organization response into a closed dialog',async()=>{
 let resolve;const o=options();o.readOrg=()=>new Promise(r=>resolve=r);const d=openAccountProfile(o);d.close();resolve({manager:{full_name:'Поздний ответ'},reports:[]});await Promise.resolve();expect(document.querySelector('dialog')).toBeNull();
});
