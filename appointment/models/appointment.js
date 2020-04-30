var mongoose = require('mongoose'),
   Schema = mongoose.Schema,
   ObjectId = Schema.ObjectId;

var validForDate = new Schema({startDateTime: {type: Date}, endDateTime: {type: Date}});
   
var appointmentSchema = new Schema({
	id: {type: String}, //ObjectId
	href: {type: String},
	externalId: {type: String},
	category: {type: String},
	description: {type: String},
	status: {type: String},
	creationDate: {type: Date},
	lastUpdate: {type: Date},
	validFor: {type: validForDate},
	baseType: {type: String},
	type: {type: String},
	schemaLocation: {type: String}
}, { collection: 'appointment' });

module.exports = mongoose.model('appointment', appointmentSchema);
