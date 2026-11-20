import { join } from 'node:path';
export function projectInventory({id,config,working,workspaceId,storage,reminderSpaces,slidesSpaces,polaris,financeMounts,financeProjectName,intelligenceRuntime,locations,add,file,source,safePath,paths,object}) {

      if (safePath(config.dataDir)) file('记录、照片与场景指南', 'sqlite', join(config.dataDir, `${id}.db`));
    {
      add({ label: working ? '旧设备待导入记录' : '凭证与照片', kind: 'browser', storageKey: 'memo.records.v1', description: working ? '旧设备记录会在成功连接后受控导入；尚未打开的浏览器仍保留待导入副本。' : '保存在实际使用的设备、浏览器与站点来源中，使用Memo的完整JSON导出恢复；服务器卷不包含它。' });
      add({ label: '偏好与流程', kind: 'browser', storageKey: 'memo.prefs.v1 / memo.flow.v1', description: '浏览器本地状态，随原有完整JSON备份迁移。' });
    }
}
