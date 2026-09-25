import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { SettingsPage } from '../../pages/SettingsPage'

const settings = { cards:{today:true,money:true,finance:true,stock:true,calendar:true}, items:{today:{balance:true,menu:true,events:true},money:{personal:true,householdTotal:true,unsettled:true,eventSummary:true},stock:{shoppingCount:true,lowStock:true,commonItems:true},calendar:{events:true,balance:true}} }
describe('SettingsPage', () => { it('親をOFFにすると子を無効化し保存できる', async () => { let saved = false; server.use(http.get('/api/user-settings',()=>HttpResponse.json(settings)),http.put('/api/user-settings',()=>{saved=true;return HttpResponse.json(settings)})); render(<MemoryRouter><SettingsPage /></MemoryRouter>); const user=userEvent.setup(); const parent=await screen.findByLabelText('今日の状況'); await user.click(parent); expect(screen.getByLabelText('収支')).toBeDisabled(); await user.click(screen.getByRole('button',{name:'保存'})); await waitFor(()=>expect(saved).toBe(true)) }) })
