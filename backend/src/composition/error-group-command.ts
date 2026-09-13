import { ErrorGroupRepository } from "../repository/error-group.repository.js";
import { ErrorGroupCommandService } from "../services/error-command-group.service.js";

const repository = new ErrorGroupRepository();

const errorGroupCommandService = new ErrorGroupCommandService(repository);

export { errorGroupCommandService };
