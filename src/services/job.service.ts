import prisma from "../config/db";
import { JobRegisterInput, JobRegisterSchema } from "../api/v1/job/job.validator";
import { AppError } from "../utils/error";



export const registerJob = (data: JobRegisterInput)=>{
    
    const existingJob = prisma.job.findUnique({where:data.jobId})

}