'use strict';

/**
 * Confirmed DWH schema for Akij Essentials "Rice Bulk" channel (channel 145).
 * Discovered live from the DWH (2026-08-24). This is the single source of
 * truth for how operational SQL maps to the normalized fact model.
 *
 * Hierarchy (rtm.tblTerritoryInfoSetupArc, channel 145):
 *   L1 National ("Akij Essentials Ltd. (Rice Bulk)")
 *   L5 Region (5)   -> maps to app level REGION
 *   L6 Zone (12)    -> maps to app level ZONE
 *   L7 Territory (35) -> maps to app level TERRITORY
 */

const TABLES = {
  salesOrderHeader: 'oms.tblSalesOrderHeaderArc',
  salesOrderRow: 'oms.tblSalesOrderRowArc',
  deliveryHeader: 'sms.tblDeliveryHeaderArc',
  deliveryRow: 'sms.tblDeliveryRowArc',
  territoryInfo: 'rtm.tblTerritoryInfoArc',
  territorySetup: 'rtm.tblTerritoryInfoSetupArc',
};

const COLUMNS = {
  salesOrderHeader: {
    id: 'intSalesOrderId',
    channel: 'intDistributionChannelId',
    date: 'dteSalesOrderDate',
    active: 'isActive',
    orderNo: 'strSalesOrderCode',
    customer: 'strSoldToPartnerName',
    territoryId: 'intTerritoryId',
    isCompleted: 'isCompleted',
    isRejected: 'isRejected',
  },
  salesOrderRow: {
    orderId: 'intSalesOrderId',
    orderNo: 'strSalesOrderCode',
    item: 'strItemName',
    uom: 'strUOM',
    quantity: 'numOrderQuantity',
    value: 'numOrderValue',
    price: 'numItemPrice',
    deliveredQty: 'numDeliveredQuantity',
    undeliveredQty: 'numUndeliveryQuantity',
    undeliveredValue: 'numUndeliveryValues',
  },
  deliveryHeader: {
    id: 'intDeliveryId',
    channel: 'intDistributionChannelId',
    date: 'dteDeliveryDate',
    active: 'isActive',
    customer: 'strSoldToPartnerName',
  },
  deliveryRow: {
    deliveryId: 'intDeliveryId',
    orderId: 'intSalesOrderId',
    orderNo: 'strSalesOrderCode',
    item: 'strItemName',
    uom: 'strUOM',
    quantity: 'numQuantity',
    value: 'numDeliveryValue',
  },
  territoryInfo: {
    id: 'intTerritoryId',
    name: 'strTerritoryName',
    level: 'intLevelId',
    levelCode: 'strLevelCode',
    channelId: 'intChannelId',
  },
};

module.exports = { TABLES, COLUMNS };
