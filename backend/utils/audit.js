import { AuditLog } from '../models/index.js';

export const logAudit = async (userId, action, tableName = null, recordId = null, beforeState = null, afterState = null, req = null) => {
  try {
    await AuditLog.create({
      user_id: userId,
      action,
      table_name: tableName,
      record_id: recordId,
      before_state: beforeState,
      after_state: afterState,
      ip_address: req?.ip || req?.connection?.remoteAddress,
      user_agent: req?.get('user-agent'),
    });
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
};

export const createAuditLog = async ({ user_id, action, table_name = null, record_id = null, before_state = null, after_state = null, ip_address = null, user_agent = null }) => {
  try {
    await AuditLog.create({
      user_id,
      action,
      table_name,
      record_id,
      before_state,
      after_state,
      ip_address,
      user_agent,
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};
