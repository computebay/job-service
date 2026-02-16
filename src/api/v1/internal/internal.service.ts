import {getChannel} from '@/config/rabbitmq'
import prisma from '@/config/db';
import { jobRoutes } from '../jobs/job.routes';
import { JobStatus } from '@prisma/client';

let channel = getChannel()
export const  UpdateJobState = async()=>{

    await channel.bindQueue("job-service.events","compute-bay.jobs","job.#");

    channel.consume("job-service.events", async(msg)=>{
        if(!msg) return;

        try {
            const routingKey = msg.fields.routingKey
            const data = JSON.parse(msg.content.toString()) as Record<string,unknown>

            if(routingKey == 'job.created'){
                //need to figure out what to do when scheduler emits job.created
            }

            if(routingKey == 'job.scheduled'){
                //update job state
                await prisma.job.update({
                    where:{data.jobId}
                })
            }
        } catch (error) {
            
        }
    })




}