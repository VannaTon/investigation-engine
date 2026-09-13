import { ErrorGroupRepository } from "../repository/error-group.repository.js";
import { ErrorGroupQueryService } from "../services/erorr.group.service.js";
const repository = new ErrorGroupRepository();

const errorGroupQueryService = new ErrorGroupQueryService(repository);

export { errorGroupQueryService };
