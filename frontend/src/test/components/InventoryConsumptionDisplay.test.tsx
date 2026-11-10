import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryModal } from '../../components/zaiko/InventoryModal'
const props = { categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
it.each(['0', '0.01'])('OFFで不正な消費量%sを保存すると修正入力を表示し有効値への修正中も保持する', async (invalidValue) => {
 const bodies: unknown[] = []
 server.use(http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }))
 const user = userEvent.setup(); render(<InventoryModal {...props} />)
 await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_food')
 const toggle = screen.getByRole('switch', { name: '毎日の自動消費' })
 await user.click(toggle)
 await user.type(screen.getByLabelText('1日の消費量（任意）'), invalidValue)
 await user.click(toggle)
 expect(screen.queryByLabelText('1日の消費量（任意）')).not.toBeInTheDocument()
 await user.click(screen.getByRole('button', { name: '保存' }))
 expect(bodies).toHaveLength(0)
 expect(toggle).not.toBeChecked()
 const correctionInput = screen.getByLabelText('1日の消費量（任意）')
 expect(correctionInput).toBeVisible()
 expect(correctionInput).toHaveValue(Number(invalidValue))
 expect(screen.getByRole('alert')).toHaveTextContent('1日の消費量')
 await user.clear(correctionInput)
 await user.type(correctionInput, '1')
 expect(screen.getByLabelText('1日の消費量（任意）')).toBeVisible()
 expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(1)
 await user.type(screen.getByLabelText('1日の消費量（任意）'), '.5')
 expect(screen.getByLabelText('1日の消費量（任意）')).toBeVisible()
 expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(1.5)
 await user.click(screen.getByRole('button', { name: '保存' }))
 await waitFor(() => expect(bodies).toHaveLength(1))
 expect(bodies[0]).toMatchObject({ dailyConsumption: 1.5, autoConsumptionEnabled: false })
})
it('未設定OFFからONで入力を開き空欄ONの保存を拒否する', async () => {
 const bodies: unknown[] = []
 server.use(http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }))
 const user = userEvent.setup(); render(<InventoryModal {...props} />)
 await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_food')
 expect(screen.queryByLabelText('1日の消費量（任意）')).not.toBeInTheDocument()
 const toggle = screen.getByRole('switch', { name: '毎日の自動消費' }); expect(toggle).toBeEnabled()
 await user.click(toggle)
 expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(null)
 await user.click(screen.getByRole('button', { name: '保存' }))
 expect(screen.getByRole('alert')).toHaveTextContent('1日の消費量')
 expect(bodies).toHaveLength(0)
})
it('OFFはdraft値を隠して保持し再ONで復元、OFF保存でも量を保持する', async () => {
 const bodies: unknown[] = []
 server.use(http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }))
 const user = userEvent.setup(); render(<InventoryModal {...props} />)
 await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_food')
 const toggle = screen.getByRole('switch'); await user.click(toggle)
 await user.type(screen.getByLabelText('1日の消費量（任意）'), '0.3')
 await user.click(toggle)
 expect(screen.queryByLabelText('1日の消費量（任意）')).not.toBeInTheDocument()
 await user.click(toggle); expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(0.3)
 await user.click(toggle); await user.click(screen.getByRole('button', { name: '保存' }))
 await waitFor(() => expect(bodies).toHaveLength(1))
 expect(bodies[0]).toMatchObject({ dailyConsumption: 0.3, autoConsumptionEnabled: false })
})
it('保存済OFFの消費量は隠し再ONで保存値を復元し取消では送らない', async () => {
 let writes = 0
 server.use(http.patch('/api/inventory-items/1', () => { writes++; return HttpResponse.json({}) }))
 const close = vi.fn(); const user = userEvent.setup()
 render(<InventoryModal {...props} onClose={close} item={{ id:1, name:'[E2E_TEST] testuser_food', categoryId:1,storeId:null,quantity:1,threshold:0,dailyConsumption:0.2,autoConsumptionEnabled:false }} />)
 expect(screen.queryByLabelText('1日の消費量（任意）')).not.toBeInTheDocument()
 await user.click(screen.getByRole('switch'))
 expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(0.2)
 await user.click(screen.getByRole('button', { name:'キャンセル' }))
 expect(close).toHaveBeenCalledTimes(1); expect(writes).toBe(0)
})
