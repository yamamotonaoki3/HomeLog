import type { ComponentProps } from 'react'
import { InventoryModal } from '../../components/zaiko/InventoryModal'
import { apiClient } from '../../api/client'

/** Form-only test adapter. Production pending/scope behavior is tested through InventoryPanel. */
export function InventoryModalHarness(props: ComponentProps<typeof InventoryModal>) {
  const save: NonNullable<ComponentProps<typeof InventoryModal>['onPlanSave']> = async (inventory, enabled, links) => {
    const body = { ...inventory, ...(props.item ? { expectedMenuPlanRevision: props.item.menuPlanRevision ?? 0 } : {}), menuPlan: { requestId: crypto.randomUUID(), enabled, links } }
    if (props.item) await apiClient.put('/inventory-items/' + props.item.id, body)
    else await apiClient.post('/inventory-items', body)
    return { kind: 'success' }
  }
  return <InventoryModal {...props} onPlanSave={props.onPlanSave ?? save} />
}
