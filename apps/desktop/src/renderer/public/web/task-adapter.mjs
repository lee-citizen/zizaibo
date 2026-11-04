// The E-language contract remains in PrinterHost.cs. This maps its existing tasks to 3D products.
export function expandTask(task) {
  const count=Number(task.count ?? 1),size=Number(task.size ?? 1);
  if(!Number.isInteger(count)||count<1||count>100||![1,2].includes(size))throw Error('数量或大小无效');
  if(!task.nickname||!task.avatarUrl)throw Error('缺少昵称或头像');
  const labels={entry:'进场',like:'点赞',comment:'评论',follow:'关注',gift:'礼物'};
  return Array.from({length:count},(_,i)=>({name:String(task.nickname),avatar:task.avatarUrl,
    size:size===2?'large':'small',priority:task.event==='gift',source:labels[task.event]||'打印',
    copy:i+1,total:count,score:80+Math.floor(Math.random()*21),completionKey:String(task.id)+':'+i}));
}
export function insertTasks(queue,jobs) {
  let at=queue.length;
  if(jobs[0]?.priority){at=queue.findIndex(job=>!job.priority);if(at<0)at=queue.length;}
  queue.splice(at,0,...jobs);
}
